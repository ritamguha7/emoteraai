"""
Emotera AI — Audio Processing Utilities
Handles format conversion (ffmpeg), normalization, and sample rate management
for the Whisper speech-to-text pipeline.
"""

import io
import os
import tempfile
import subprocess
import logging
import shutil
from typing import Optional, Tuple

import numpy as np

logger = logging.getLogger("emotera-ml")

# ─── ffmpeg Detection ─────────────────────────────────────────

def get_ffmpeg_path() -> str:
    """Find ffmpeg binary on the system."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise RuntimeError(
            "ffmpeg not found on system PATH. "
            "Install it with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)"
        )
    return ffmpeg


def check_ffmpeg() -> bool:
    """Check if ffmpeg is available."""
    try:
        get_ffmpeg_path()
        return True
    except RuntimeError:
        return False


# ─── Audio Format Conversion ─────────────────────────────────

SUPPORTED_FORMATS = {"wav", "mp3", "webm", "ogg", "flac", "m4a", "aac"}


def convert_to_wav_bytes(
    input_bytes: bytes,
    input_format: str = "webm",
    sample_rate: int = 16000,
    channels: int = 1,
) -> bytes:
    """
    Convert audio bytes of any supported format to 16kHz mono WAV using ffmpeg.
    
    Args:
        input_bytes: Raw audio file bytes
        input_format: Source format hint (wav, mp3, webm, etc.)
        sample_rate: Target sample rate (default 16000 for Whisper)
        channels: Target channel count (default 1 = mono)
    
    Returns:
        WAV file bytes (16-bit PCM, 16kHz, mono)
    """
    ffmpeg = get_ffmpeg_path()
    
    # Create temp files for input and output
    tmp_dir = tempfile.mkdtemp(prefix="emotera_audio_")
    input_path = os.path.join(tmp_dir, f"input.{input_format}")
    output_path = os.path.join(tmp_dir, "output.wav")
    
    try:
        # Write input bytes to temp file
        with open(input_path, "wb") as f:
            f.write(input_bytes)
        
        # Run ffmpeg conversion
        cmd = [
            ffmpeg,
            "-y",                          # Overwrite output
            "-i", input_path,              # Input file
            "-ar", str(sample_rate),       # Sample rate
            "-ac", str(channels),          # Mono
            "-sample_fmt", "s16",          # 16-bit PCM
            "-f", "wav",                   # Output format
            output_path
        ]
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=30,
        )
        
        if result.returncode != 0:
            stderr = result.stderr.decode("utf-8", errors="replace")
            logger.error(f"ffmpeg conversion failed: {stderr}")
            raise RuntimeError(f"ffmpeg conversion failed: {stderr[:500]}")
        
        # Read converted WAV
        with open(output_path, "rb") as f:
            wav_bytes = f.read()
        
        logger.info(
            f"Audio converted: {input_format} ({len(input_bytes)} bytes) "
            f"→ WAV ({len(wav_bytes)} bytes, {sample_rate}Hz, {channels}ch)"
        )
        return wav_bytes
    
    finally:
        # Always cleanup temp files
        _cleanup_dir(tmp_dir)


def convert_file_to_wav(
    input_path: str,
    sample_rate: int = 16000,
    channels: int = 1,
) -> str:
    """
    Convert an audio file to 16kHz mono WAV. Returns path to the converted file.
    Caller is responsible for cleaning up the returned temp file.
    
    Args:
        input_path: Path to the source audio file
        sample_rate: Target sample rate
        channels: Target channel count
    
    Returns:
        Path to the converted WAV file (in a temp directory)
    """
    ffmpeg = get_ffmpeg_path()
    
    tmp_dir = tempfile.mkdtemp(prefix="emotera_audio_")
    output_path = os.path.join(tmp_dir, "converted.wav")
    
    cmd = [
        ffmpeg,
        "-y",
        "-i", input_path,
        "-ar", str(sample_rate),
        "-ac", str(channels),
        "-sample_fmt", "s16",
        "-f", "wav",
        output_path,
    ]
    
    result = subprocess.run(cmd, capture_output=True, timeout=30)
    
    if result.returncode != 0:
        _cleanup_dir(tmp_dir)
        stderr = result.stderr.decode("utf-8", errors="replace")
        raise RuntimeError(f"ffmpeg conversion failed: {stderr[:500]}")
    
    logger.info(f"File converted: {input_path} → {output_path}")
    return output_path


# ─── Audio Normalization ─────────────────────────────────────

def normalize_audio(audio: np.ndarray) -> np.ndarray:
    """
    Normalize audio amplitude to [-1.0, 1.0] range.
    Prevents clipping and ensures consistent volume levels.
    
    Args:
        audio: numpy array of audio samples (float32)
    
    Returns:
        Normalized audio array
    """
    if audio.size == 0:
        return audio
    
    max_val = np.max(np.abs(audio))
    if max_val > 0:
        audio = audio / max_val
    return audio.astype(np.float32)


def ensure_mono(audio: np.ndarray) -> np.ndarray:
    """Convert stereo/multi-channel audio to mono by averaging channels."""
    if len(audio.shape) > 1:
        audio = np.mean(audio, axis=1)
    return audio


# ─── WAV Buffer Creation (for WebSocket chunks) ──────────────

def pcm_chunks_to_wav_bytes(
    chunks: list[bytes],
    sample_rate: int = 16000,
    num_channels: int = 1,
    bits_per_sample: int = 16,
) -> bytes:
    """
    Combine raw PCM chunks into a proper WAV file in memory.
    Used for WebSocket streaming where we accumulate binary chunks.
    
    Args:
        chunks: List of raw PCM byte buffers
        sample_rate: Audio sample rate
        num_channels: Number of audio channels
        bits_per_sample: Bit depth
    
    Returns:
        Complete WAV file as bytes
    """
    pcm_data = b"".join(chunks)
    data_size = len(pcm_data)
    
    if data_size == 0:
        raise ValueError("No audio data to convert")
    
    # Build WAV header (44 bytes)
    byte_rate = sample_rate * num_channels * bits_per_sample // 8
    block_align = num_channels * bits_per_sample // 8
    
    header = io.BytesIO()
    
    # RIFF header
    header.write(b"RIFF")
    header.write((36 + data_size).to_bytes(4, "little"))
    header.write(b"WAVE")
    
    # fmt sub-chunk
    header.write(b"fmt ")
    header.write((16).to_bytes(4, "little"))          # Sub-chunk size
    header.write((1).to_bytes(2, "little"))            # PCM format
    header.write(num_channels.to_bytes(2, "little"))
    header.write(sample_rate.to_bytes(4, "little"))
    header.write(byte_rate.to_bytes(4, "little"))
    header.write(block_align.to_bytes(2, "little"))
    header.write(bits_per_sample.to_bytes(2, "little"))
    
    # data sub-chunk
    header.write(b"data")
    header.write(data_size.to_bytes(4, "little"))
    
    return header.getvalue() + pcm_data


# ─── Temp File Helpers ────────────────────────────────────────

def create_temp_wav(audio_bytes: bytes) -> str:
    """Write audio bytes to a temp WAV file and return the path."""
    tmp = tempfile.NamedTemporaryFile(
        suffix=".wav", prefix="emotera_", delete=False
    )
    tmp.write(audio_bytes)
    tmp.close()
    return tmp.name


def cleanup_temp_file(path: str) -> None:
    """Safely remove a temp file."""
    try:
        if path and os.path.exists(path):
            os.unlink(path)
    except OSError as e:
        logger.warning(f"Failed to cleanup temp file {path}: {e}")


def _cleanup_dir(dir_path: str) -> None:
    """Safely remove a temp directory and all contents."""
    try:
        if dir_path and os.path.exists(dir_path):
            shutil.rmtree(dir_path)
    except OSError as e:
        logger.warning(f"Failed to cleanup temp dir {dir_path}: {e}")
