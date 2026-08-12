# Intermediario de reportes INE

Worker de Cloudflare para validar códigos censales y descargar la ficha PDF oficial sin exponer la sesión temporal del INE en el navegador.

## Rutas

- `GET /health`
- `POST /validate` con `{ "codigos": ["..."] }`
- `POST /report` con `{ "codigos": ["..."] }`

## Publicación

```powershell
npm install
npx wrangler login
npx wrangler deploy
```

Después de publicar, copie la URL `https://geoportal-ine-pdf.<subdominio>.workers.dev` en `assets/capas/ine_m8_config.js`.

La variable `ALLOWED_ORIGINS` debe contener solamente los orígenes autorizados, separados por comas. Para GitHub Pages el origen es `https://ctemplar-zz.github.io`; la ruta `/WWF_HOWWE/` no se incluye.
