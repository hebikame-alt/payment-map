import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AdminApp from './AdminApp.jsx'

const isAdminRoute = window.location.pathname.replace(/\/$/, '').endsWith('/admin')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isAdminRoute ? <AdminApp /> : <App />}
  </StrictMode>,
)
