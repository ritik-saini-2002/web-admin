# React + Vite

## Hosting on the LAN

Build the app, then start the production server:

```bash
npm run build
npm run serve
```

The production server listens on `0.0.0.0:5008`, so other PCs on the same network can open:

```text
http://<server-ip>:5008
```

Use `start-server.bat` on Windows to run the same server in the background. The hosted server includes the `/pcproxy/...` route required by PC Control, so do not host `dist` with a plain static file server unless you also provide that proxy route.

For PC Control to work, the server machine must be able to reach each target PC agent at `http://<target-pc-ip>:5000`, and the target PC firewall must allow inbound traffic on that agent port.

The bundled agent reference in `agent/agent_v12.py` uses command port `5000`, stream port `5001`, default user key `Saini@2004`, and master key `Ritik@2004`.

PocketBase is configured through `.env`:

```text
VITE_PB_URL=http://192.168.5.32/pocketbase
```

Rebuild after changing `.env`, because Vite embeds these values into the production bundle.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
