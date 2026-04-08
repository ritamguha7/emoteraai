// demo-counter.js stub
window.volumoDemo = {
  tries: parseInt(localStorage.demoTries || 0),
  getDemoTries() {
    return this.tries;
  },
  activateDemo() {
    if (this.tries < 3) {
      localStorage.setItem('volumoUser', 'Demo User');
      localStorage.demoTries = ++this.tries;
      return true;
    }
    return false;
  }
};

