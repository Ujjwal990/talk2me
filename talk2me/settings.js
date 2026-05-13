chrome.storage.local.get(['backendUrl'], (r) => {
  if (r.backendUrl) document.getElementById('backendUrl').value = r.backendUrl;
});

document.getElementById('saveBtn').addEventListener('click', () => {
  const backendUrl = document.getElementById('backendUrl').value.trim() || 'http://localhost:3000';
  chrome.storage.local.set({ backendUrl }, () => {
    const confirm = document.getElementById('saveConfirm');
    confirm.style.display = 'block';
    setTimeout(() => { confirm.style.display = 'none'; }, 2500);
  });
});
