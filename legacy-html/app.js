// app.js stub for Volumo dashboard
// Basic recording and emotion stub using CDN libs

document.addEventListener('DOMContentLoaded', async () => {
  // Remove skeleton
  document.body.classList.remove('skeleton');

  // Stub elements
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const currentEmotion = document.getElementById('currentEmotion');
  const confidence = document.getElementById('confidence');
  const sessionTime = document.getElementById('sessionTime');
  const samples = document.getElementById('samples');
  const historyList = document.getElementById('historyList');
  const historyCount = document.getElementById('historyCount');
  const logoutBtn = document.getElementById('logoutBtn');
  const currentUser = document.getElementById('currentUser');

  let mediaRecorder;
  let isRecording = false;
  let sampleCount = 0;
  let sessionStart = null;

  // Stub emotion model (replace with real TF.js SpeechCommands)
  const emotions = ['NEUTRAL', 'HAPPY', 'SAD', 'ANGRY'];
  function getRandomEmotion() {
    return emotions[Math.floor(Math.random() * emotions.length)];
  }

  // Update UI
function updateStats(emotion, conf) {
    currentEmotion.textContent = emotion;
    currentEmotion.className = 'stat-value ' + emotion.toLowerCase();
    confidence.textContent = conf + '%';
    samples.textContent = sampleCount;

    // Add to history
    const li = document.createElement('li');
    li.className = 'history-item ' + emotion.toLowerCase();
    li.innerHTML = `<span>${emotion}</span><span>${conf}%</span>`;
    historyList.prepend(li);
    historyCount.textContent = `(${Math.min(5, ++sampleCount)})`;

    if (sampleCount > 5) historyList.lastElementChild.remove();

    // Update chart data (stub)
    if (window.myChart) {
      myChart.data.labels.push(new Date().toLocaleTimeString());
      myChart.data.datasets[0].data.push(conf);
      myChart.update();
    }
  }

  // Recording timer
  function updateTimer() {
    if (sessionStart) {
      const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
      const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
      const secs = (elapsed % 60).toString().padStart(2, '0');
      sessionTime.textContent = `${mins}:${secs}`;
    }
  }

  setInterval(updateTimer, 1000);

  // Start recording
  startBtn.addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      isRecording = true;
      sessionStart = Date.now();
      sampleCount = 0;
      startBtn.classList.add('recording');
      stopBtn.disabled = false;
      startBtn.innerHTML = '<i class="fas fa-microphone"></i> Recording...';
      
      // Stub emotion detection every 2s
      const interval = setInterval(() => {
        if (!isRecording) {
          clearInterval(interval);
          return;
        }
        const emotion = getRandomEmotion();
        const conf = Math.floor(Math.random() * 30 + 70);
        updateStats(emotion, conf);
      }, 2000);
    } catch (err) {
      alert('Microphone access denied');
    }
  });

  // Stop
  stopBtn.addEventListener('click', () => {
    isRecording = false;
    sessionStart = null;
    startBtn.classList.remove('recording');
    stopBtn.disabled = true;
    startBtn.innerHTML = '<i class="fas fa-microphone-slash"></i> Start Recording';
    if (mediaRecorder) mediaRecorder.stop();
  });

  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('volumoUser');
    window.location.href = 'Auth.html';
  });

// Drag & drop MP3 upload
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const uploadList = document.getElementById('uploadList');

uploadArea.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('dragover');
});
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'audio/mpeg');
  handleFiles(files);
});
fileInput.addEventListener('change', (e) => handleFiles(Array.from(e.target.files)));

function handleFiles(files) {
  files.forEach(file => {
    if (file.type === 'audio/mpeg') {
      const item = document.createElement('div');
      item.className = 'upload-item';
      item.innerHTML = `<i class="fas fa-music"></i> ${file.name} <span class="file-size">${(file.size/1024/1024).toFixed(1)}MB</span>`;
      uploadList.appendChild(item);
      // Process MP3 for emotion analysis stub
      setTimeout(() => {
        const emotion = getRandomEmotion();
        const conf = Math.floor(Math.random() * 30 + 70);
        updateStats(emotion, conf);
      }, 1000);
    }
  });
}

// Check login
  if (!localStorage.getItem('volumoUser')) {
    window.location.href = 'Auth.html';
  } else {
    currentUser.textContent = localStorage.getItem('volumoUser') || 'Demo User';
  }
});

