import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import { ToastProvider } from '@/context/ToastContext';
import { SettingsProvider } from '@/context/SettingsContext';
import { UploadProvider } from '@/context/UploadContext';
import { AuthProvider } from '@/context/AuthContext';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found');

createRoot(rootElement).render(
  <StrictMode>
    <ToastProvider>
      <SettingsProvider>
        <UploadProvider>
          <AuthProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </AuthProvider>
        </UploadProvider>
      </SettingsProvider>
    </ToastProvider>
  </StrictMode>,
);
