# Reader Frontend

Shared Vue 3 frontend for [`reader-rust`](https://github.com/givenge/reader-rust) and [`reader-worker`](https://github.com/givenge/reader-worker).

Both backend repositories consume this repository as the `frontend` Git submodule. Make frontend changes here, then update the submodule commit in each backend that should receive them. Backend-specific API gaps belong in the backend implementation so the UI stays shared.

## Development

```bash
npm ci
npm run dev
```

The Vite proxy targets the Rust server at `http://127.0.0.1:8080` by default. To use a local Worker server, set `VITE_API_PROXY_TARGET`:

```bash
VITE_API_PROXY_TARGET=http://127.0.0.1:8787 npm run dev
```

Build and unit-test commands are `npm run build` and `npm test`. Build output is written to `dist/`; the Rust Dockerfiles and Worker Assets configuration serve that directory from their respective checkouts.

When cloning either backend, initialize the frontend submodule before running frontend commands:

```bash
git submodule update --init frontend
```
