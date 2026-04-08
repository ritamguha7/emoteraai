import os
import glob
import random
import requests

ML_SERVICE_URL = "http://localhost:5001"
RAVDESS_DIR = os.path.join(os.path.dirname(__file__), "..", "ml-service", "ravdess_data")

class EmoteraEnv:
    def __init__(self):
        self.audio_files = []
        for root, _, files in os.walk(RAVDESS_DIR):
            for file in files:
                if file.endswith(".wav"):
                    self.audio_files.append(os.path.join(root, file))
        
        if not self.audio_files:
            print("Warning: No RAVDESS audio files found. Step simulation will fail unless handled.")

        self.call_duration = 0.0
        self.emotion_trend = []
        self.current_state = None
        self.steps = 0
        self.max_steps = 5  # Keep episode short for demonstration
        self.history = []

    def reset(self):
        self.call_duration = 0.0
        self.emotion_trend = []
        self.steps = 0
        self.history = []
        
        # Initial user audio state
        return self._process_audio_step(old_emotion="neutral", response_type="neutral")
        
    def step(self, action):
        response_type = action.get("response_type", "solution")
        message = action.get("message", "")
        
        old_emotion = self.current_state["emotion"]
        
        # Process the next caller state
        next_obs = self._process_audio_step(old_emotion, response_type)
        new_emotion = self.current_state["emotion"]
        
        # Compute reward
        reward, is_appropriate = self._calculate_reward(old_emotion, new_emotion, response_type)
        
        self.steps += 1
        done = self.steps >= self.max_steps
        
        self.history.append({
            "observation": next_obs,
            "action": action,
            "reward": reward,
            "is_appropriate": is_appropriate,
            "emotion_improved": self._get_emotion_polarity(new_emotion) > self._get_emotion_polarity(old_emotion),
            "step_count": self.steps
        })
        
        info = {
            "old_emotion": old_emotion,
            "new_emotion": new_emotion,
            "response_type": response_type,
            "appropriate_response": is_appropriate
        }
        
        return next_obs, reward, done, info
        
    def state(self):
        return {
            "internal_steps": self.steps,
            "call_duration": self.call_duration,
            "emotion_trend": self.emotion_trend,
            "current_observation": self.current_state
        }

    def _process_audio_step(self, old_emotion, response_type):
        """Simulates hearing user audio and analyzing it via the backend services."""
        if not self.audio_files:
            # Fallback mock if audio missing
            emotion = random.choice(["neutral", "angry", "happy", "sad"])
            transcript = "Simulated caller phrase without data."
            confidence = 80.0
        else:
            # Optionally bias the simulation
            audio_path = random.choice(self.audio_files)
            
            # 1. Analyze emotion via local ML service
            try:
                with open(audio_path, 'rb') as f:
                    audio_bytes = f.read()
                analyze_resp = requests.post(f"{ML_SERVICE_URL}/analyze", data=audio_bytes, headers={"Content-Type": "application/octet-stream"}, timeout=10)
                if analyze_resp.status_code == 200:
                    analyze_data = analyze_resp.json()
                else:
                    analyze_data = {"emotion": "neutral", "confidence": 0.0}
            except Exception as e:
                analyze_data = {"emotion": "neutral", "confidence": 0.0}

            # 2. Transcribe using Whisper local ML service
            transcript = ""
            try:
                with open(audio_path, 'rb') as f:
                    files = {'file': (os.path.basename(audio_path), f, 'audio/wav')}
                    transcribe_resp = requests.post(f"{ML_SERVICE_URL}/transcribe", files=files, timeout=20)
                    if transcribe_resp.status_code == 200:
                        transcript = transcribe_resp.json().get("text", "")
            except Exception as e:
                transcript = "Transcript simulation failed."

            emotion = analyze_data.get("emotion", "neutral")
            
            # ML service returns string integers representing LabelEncoder classes
            LABEL_MAPPING = {"0": "angry", "1": "happy", "2": "neutral", "3": "sad"}
            emotion = LABEL_MAPPING.get(str(emotion), emotion)
            
            confidence = analyze_data.get("confidence", 0.0)
        
        self.emotion_trend.append(emotion)
        self.call_duration += 2.0 
        
        obs = {
            "emotion": emotion,
            "confidence": confidence,
            "transcript": transcript,
            "call_duration": self.call_duration,
            "emotion_trend": list(self.emotion_trend)
        }
        
        self.current_state = obs
        return obs

    def _get_emotion_polarity(self, emotion):
        emotion = emotion.lower()
        if emotion in ["angry", "sad", "fearful", "disgusted"]:
            return -1
        elif emotion in ["happy", "calm"]:
            return 1
        return 0

    def _calculate_reward(self, old_emotion, new_emotion, response_type):
        old_pol = self._get_emotion_polarity(old_emotion)
        new_pol = self._get_emotion_polarity(new_emotion)
        
        reward = 0.0
        
        if new_pol > old_pol: # Improved
            reward += 0.3
        elif new_pol < old_pol: # Worsened
            reward -= 0.5
            
        appropriate = False
        if old_pol == -1: 
            if response_type in ["empathetic", "escalation"]: appropriate = True
        elif old_pol == 0: 
            if response_type == "solution": appropriate = True
        elif old_pol == 1: 
            if response_type == "solution": appropriate = True
                
        if appropriate:
            reward += 0.2
        else:
            reward -= 0.3
            
        # +0.1 for faster response base
        reward += 0.1
        
        return max(-1.0, min(1.0, float(reward))), appropriate
