class OpenEnvTasks:
    @staticmethod
    def grade_emotion_stabilization(history):
        """
        Task 1 (Easy): Emotion Stabilization
        Goal: Reduce negative emotion.
        Score = percentage of emotion improvement over steps
        """
        if not history:
            return 0.0
        
        improvements = [1 for step in history if step.get("emotion_improved", False)]
        total_transitions = len(history)
        
        score = len(improvements) / total_transitions if total_transitions > 0 else 0.0
        return round(score, 2)

    @staticmethod
    def grade_smart_response(history):
        """
        Task 2 (Medium): Smart Response Selection
        Goal: Choose correct response_type
        Score = correct responses / total responses
        """
        if not history:
            return 0.0
        
        appropriate = [1 for step in history if step.get("is_appropriate", False)]
        total = len(history)
        
        score = len(appropriate) / total if total > 0 else 0.0
        return round(score, 2)

    @staticmethod
    def grade_call_resolution(history):
        """
        Task 3 (Hard): Call Resolution Efficiency
        Goal: Improve emotion + reduce resolution time
        Score = average of emotion score, speed score, and relevance score
        """
        if not history:
            return 0.0
        
        emotion_score = OpenEnvTasks.grade_emotion_stabilization(history)
        relevance_score = OpenEnvTasks.grade_smart_response(history)
        
        # Speed heuristic (assuming max steps = 5 normally, taking 1 step is 1.0, 5 steps is 0.2)
        total_steps = history[-1].get("step_count", len(history))
        speed_score = max(0.0, 1.0 - (total_steps * 0.15)) 
        
        final_score = (emotion_score + relevance_score + speed_score) / 3.0
        return round(final_score, 2)
