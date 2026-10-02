import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import NavHistoryProvider from './components/shell/NavHistoryProvider'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <NavHistoryProvider>
        <App />
      </NavHistoryProvider>
    </BrowserRouter>
  </StrictMode>,
)
