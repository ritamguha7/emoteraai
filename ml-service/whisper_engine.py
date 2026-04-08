"""
Emotera AI — Whisper Speech-to-Text Engine
Manages OpenAI Whisper model lifecycle and provides transcription interfaces
for both file-based and in-memory audio processing.
"""

import os
import time
import logging
import tempfile
from typing import Optional

import numpy as np

import ssl
import urllib.request
ssl._create_default_https_context = ssl._create_unverified_context

logger = logging.getLogger("emotera-ml")

# ─── Global Model State ──────────────────────────────────────

_whisper_model = None
_model_name: str = "base"
_device: str = "cpu"


# ─── Model Loading ───────────────────────────────────────────

def load_whisper_model(model_name: str = "base") -> None:
    """
    Load a Whisper model into memory. Called once at startup.
    
    Supported models (by size / VRAM / speed):
      - tiny   (~39M params, ~1GB, fastest)
      - base   (~74M params, ~1GB, good balance)  ← default
      - small  (~244M params, ~2GB, better accuracy)
      - medium (~769M params, ~5GB, high accuracy)
      - large  (~1550M params, ~10GB, best accuracy)
    
    Args:
        model_name: Whisper model size identifier
    """
    global _whisper_model, _model_name, _device
    
    import whisper
    import torch
    
    _model_name = model_name
    
    # Auto-detect GPU availability
    if torch.cuda.is_available():
        _device = "cuda"
        logger.info("CUDA GPU detected — using GPU acceleration")
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        _device = "cpu"  # MPS support in Whisper is limited; CPU is more reliable
        logger.info("Apple MPS detected — using CPU for Whisper (more stable)")
    else:
        _device = "cpu"
        logger.info("No GPU detected — using CPU")
    
    start = time.time()
    logger.info(f"Loading Whisper model '{model_name}' on {_device}...")
    
    _whisper_model = whisper.load_model(model_name, device=_device)
    
    elapsed = round(time.time() - start, 1)
    logger.info(f"Whisper model '{model_name}' loaded in {elapsed}s on {_device}")


def get_model():
    """Get the loaded Whisper model, loading it if necessary."""
    global _whisper_model
    if _whisper_model is None:
        load_whisper_model(_model_name)
    return _whisper_model


def is_model_loaded() -> bool:
    """Check if the Whisper model is currently loaded."""
    return _whisper_model is not None


def get_model_info() -> dict:
    """Return information about the currently loaded model."""
    return {
        "model_name": _model_name,
        "device": _device,
        "loaded": _whisper_model is not None,
    }


# ─── Transcription — File-Based ──────────────────────────────

def transcribe_file(file_path: str, language: Optional[str] = None) -> dict:
    """
    Transcribe an audio file using Whisper.
    
    Args:
        file_path: Path to the audio file (WAV recommended, 16kHz mono)
        language: Optional language code (e.g., 'en'). None = auto-detect.
    
    Returns:
        {
            "text": "transcribed speech",
            "language": "en",
            "segments": [...],  # detailed timing info
            "processing_time_ms": 1423.5
        }
    """
    model = get_model()
    start = time.time()
    
    logger.info(f"Transcribing file: {file_path}")
    
    # Build transcribe options
    options = {
        "fp16": (_device == "cuda"),  # FP16 only on CUDA
        "verbose": False,
    }
    if language:
        options["language"] = language
    
    try:
        result = model.transcribe(file_path, **options)
    except Exception as e:
        logger.error(f"Whisper transcription failed for {file_path}: {e}")
        raise RuntimeError(f"Whisper transcription failed: {str(e)}")
    
    processing_time = round((time.time() - start) * 1000, 1)
    
    # Extract detected language
    detected_language = result.get("language", "unknown")
    text = result.get("text", "").strip()
    
    # Extract segments for detailed output
    segments = []
    for seg in result.get("segments", []):
        segments.append({
            "start": round(seg["start"], 2),
            "end": round(seg["end"], 2),
            "text": seg["text"].strip(),
        })
    
    logger.info(
        f"Transcription complete: {len(text)} chars, "
        f"lang={detected_language}, {processing_time}ms"
    )
    
    return {
        "text": text,
        "language": detected_language,
        "segments": segments,
        "processing_time_ms": processing_time,
    }


# ─── Transcription — In-Memory Audio Array ───────────────────

def transcribe_audio_array(
    audio: np.ndarray,
    sample_rate: int = 16000,
    language: Optional[str] = None,
) -> dict:
    """
    Transcribe audio from a numpy array (used for WebSocket streaming).
    
    Whisper expects:
      - float32 numpy array
      - 16kHz sample rate
      - Values normalized to [-1.0, 1.0]
    
    Args:
        audio: Audio samples as numpy float32 array
        sample_rate: Source sample rate (will resample to 16kHz if different)
        language: Optional language hint
    
    Returns:
        Same format as transcribe_file()
    """
    import whisper
    
    model = get_model()
    start = time.time()
    
    # Ensure correct dtype
    if audio.dtype != np.float32:
        audio = audio.astype(np.float32)
    
    # Resample to 16kHz if needed (Whisper's native rate)
    if sample_rate != 16000:
        try:
            import librosa
            audio = librosa.resample(audio, orig_sr=sample_rate, target_sr=16000)
            logger.info(f"Resampled audio from {sample_rate}Hz to 16000Hz")
        except ImportError:
            logger.warning(
                "librosa not available for resampling. "
                "Audio may not transcribe correctly if not 16kHz."
            )
    
    # Pad/trim to Whisper's expected length (30 seconds max per chunk)
    audio = whisper.pad_or_trim(audio)
    
    # Build options
    options = {
        "fp16": (_device == "cuda"),
        "verbose": False,
    }
    if language:
        options["language"] = language
    
    try:
        result = model.transcribe(audio, **options)
    except Exception as e:
        logger.error(f"Whisper transcription failed on audio array: {e}")
        raise RuntimeError(f"Whisper transcription failed: {str(e)}")
    
    processing_time = round((time.time() - start) * 1000, 1)
    
    detected_language = result.get("language", "unknown")
    text = result.get("text", "").strip()
    
    segments = []
    for seg in result.get("segments", []):
        segments.append({
            "start": round(seg["start"], 2),
            "end": round(seg["end"], 2),
            "text": seg["text"].strip(),
        })
    
    logger.info(
        f"Array transcription: {len(text)} chars, "
        f"lang={detected_language}, {processing_time}ms"
    )
    
    return {
        "text": text,
        "language": detected_language,
        "segments": segments,
        "processing_time_ms": processing_time,
    }


# ─── Transcription — From Bytes (convenience) ────────────────

def transcribe_wav_bytes(
    wav_bytes: bytes,
    language: Optional[str] = None,
) -> dict:
    """
    Transcribe WAV audio from raw bytes.
    Writes to a temp file, runs Whisper, then cleans up.
    
    Args:
        wav_bytes: Complete WAV file as bytes
        language: Optional language hint
    
    Returns:
        Same format as transcribe_file()
    """
    from audio_utils import cleanup_temp_file
    
    tmp_path = None
    try:
        # Write WAV bytes to temp file
        tmp = tempfile.NamedTemporaryFile(
            suffix=".wav", prefix="emotera_whisper_", delete=False
        )
        tmp.write(wav_bytes)
        tmp.close()
        tmp_path = tmp.name
        
        # Transcribe
        return transcribe_file(tmp_path, language=language)
    
    finally:
        if tmp_path:
            cleanup_temp_file(tmp_path)
