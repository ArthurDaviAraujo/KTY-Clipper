import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Inter com tamanho óptico: títulos grandes ganham o desenho "Display" sozinhos (como a SF Pro)
import '@fontsource-variable/inter/opsz.css'
import './styles.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
