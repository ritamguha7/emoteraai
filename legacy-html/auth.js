// auth.js stub
window.volumoAuth = {
  login(email, password) {
    // Stub - always success for any creds
    localStorage.setItem('volumoUser', email);
    return { success: true, email };
  },
  signup(email, password) {
    localStorage.setItem('volumoUser', email);
    return { success: true, email };
  }
};
