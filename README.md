# Finanzas Diario

Anotador de ingresos y gastos en bolívares para el teléfono: menos de 10 segundos por anotación, funciona sin internet y guarda todo en una hoja de Google Sheets de tu propio Drive. No cuesta nada ni hay que mantener nada: es una PWA estática en GitHub Pages más un Google Apps Script.

- **Instalación paso a paso:** [INSTALAR.md](INSTALAR.md)
- **Arquitectura, contratos de los CSV y reglas de negocio:** [CLAUDE.md](CLAUDE.md)

```bash
node --test                 # pruebas (sin dependencias)
node tools/mock-server.js   # probar la app en http://localhost:8787 con un backend simulado
```

Las tasas BCV vienen del repositorio público [grupoclip/bcv-api](https://github.com/grupoclip/bcv-api).
