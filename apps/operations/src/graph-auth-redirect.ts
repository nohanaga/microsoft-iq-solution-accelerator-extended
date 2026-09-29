import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';

if (window.location.hash || window.location.search) {
  void broadcastResponseToMainFrame().catch(() => {
    document.body.textContent = 'Authentication could not be completed. Close this window and try again.';
  });
}