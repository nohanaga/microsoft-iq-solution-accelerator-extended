import { runPopupRelay } from '@azure/msal-browser/popup-relay';

const continueButton = document.querySelector<HTMLButtonElement>('#continue');
continueButton?.addEventListener('click', () => {
  continueButton.disabled = true;
  try {
    runPopupRelay({
      allowedAuthorityOrigins: ['https://login.microsoftonline.com'],
      timeoutMs: 85_000,
    });
  } catch {
    window.close();
  }
});
if (continueButton) continueButton.disabled = false;