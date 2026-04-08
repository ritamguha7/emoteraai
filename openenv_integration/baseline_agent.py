import sys
from emotera_env import EmoteraEnv
from tasks import OpenEnvTasks

def select_action(observation):
    """Simple baseline heuristic agent logic"""
    emotion = observation.get("emotion", "neutral").lower()
    
    if emotion in ["angry", "sad", "fearful", "disgusted"]:
        return {
            "response_type": "empathetic",
            "message": "I completely understand why you'd feel that way. Let me help you out."
        }
    elif emotion in ["happy", "calm"]:
        return {
            "response_type": "solution",
            "message": "I'm glad to hear that! Let's get this finalized for you."
        }
    else: 
        return {
            "response_type": "solution",
            "message": "Okay, here is the information regarding your request."
        }

def run_agent():
    print("--------------------------------------------------")
    print("  Emotera OpenEnv Baseline Agent Simulation       ")
    print("--------------------------------------------------")
    print("Initializing EmoteraEnv...")
    env = EmoteraEnv()
    
    print("Resetting Environment to start a new call session...")
    obs = env.reset()
    
    print(f"\n[Initial Customer Observation]")
    print(f"  Emotion: {obs['emotion']} | Confidence: {obs['confidence']}%")
    print(f"  Transcript: '{obs['transcript'][:100]}...'\n")
    
    done = False
    step = 0
    total_reward = 0.0
    
    while not done:
        step += 1
        print(f"--- Step {step} ---")
        
        # Agent decides action
        action = select_action(obs)
        print(f"🤖 Agent -> [{action['response_type'].upper()}]: '{action['message']}'")
        
        # Environment processes interaction
        obs, reward, done, info = env.step(action)
        total_reward += reward
        
        # Environment updates observation
        print(f"👤 Customer -> {obs['emotion'].upper()} (moved from {info['old_emotion']})")
        print(f"   Reward Received: {reward:.2f}\n")

    print("\n==================================================")
    print("  Episode Complete")
    print(f"  Total Cumulative Reward: {total_reward:.2f}")
    print("==================================================\n")
    
    print("[Grading OpenEnv Tasks]")
    history = env.history
    
    task1_score = OpenEnvTasks.grade_emotion_stabilization(history)
    task2_score = OpenEnvTasks.grade_smart_response(history)
    task3_score = OpenEnvTasks.grade_call_resolution(history)
    
    print(f"🏅 Task 1: Emotion Stabilization (Easy)        : {task1_score}/1.0")
    print(f"🏅 Task 2: Smart Response Selection (Medium)   : {task2_score}/1.0")
    print(f"🏅 Task 3: Call Resolution Efficiency (Hard)   : {task3_score}/1.0")
    print("--------------------------------------------------")

if __name__ == "__main__":
    run_agent()
