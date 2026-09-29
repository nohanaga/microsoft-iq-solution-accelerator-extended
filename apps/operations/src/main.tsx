import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceRoot } from './WorkspaceRoot';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
try {
  root.render(<StrictMode><WorkspaceRoot/></StrictMode>);
} catch (error) {
  root.render(<main><h1>接続構成を確認してください</h1><p role="alert">{error instanceof Error ? error.message : '初期化に失敗しました。'}</p></main>);
}