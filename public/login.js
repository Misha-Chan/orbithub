if (Api.token()) location.href = '/chat.html';

const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

tabLogin.onclick = () => {
  tabLogin.classList.add('active'); tabRegister.classList.remove('active');
  loginForm.classList.add('active'); registerForm.classList.remove('active');
};
tabRegister.onclick = () => {
  tabRegister.classList.add('active'); tabLogin.classList.remove('active');
  registerForm.classList.add('active'); loginForm.classList.remove('active');
};

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('loginErr');
  errEl.textContent = '';
  try {
    const { token, user } = await Api.post('/auth/login', {
      email: document.getElementById('loginEmail').value.trim(),
      password: document.getElementById('loginPassword').value,
    });
    Api.setSession(token, user);
    location.href = '/chat.html';
  } catch (err) {
    errEl.textContent = err.message;
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('regErr');
  errEl.textContent = '';
  try {
    const { token, user } = await Api.post('/auth/register', {
      username: document.getElementById('regUsername').value.trim(),
      email: document.getElementById('regEmail').value.trim(),
      password: document.getElementById('regPassword').value,
    });
    Api.setSession(token, user);
    location.href = '/chat.html';
  } catch (err) {
    errEl.textContent = err.message;
  }
});
