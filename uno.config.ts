import { defineConfig, presetWind3 } from 'unocss'

// Минимальный конфиг UnoCSS — «на поиграться».
// presetWind3 даёт синтаксис утилит, совместимый с Tailwind.
// Preflight выключен, чтобы не конфликтовать со сбросом стилей Tailwind.
export default defineConfig({
  presets: [
    presetWind3({ preflight: false }),
  ],
})
