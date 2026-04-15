<h2 align="center">
  <img height="150" alt="Typing Mind - A better UI for ChatGPT" src="https://www.typingmind.com/banner.png" />
<br/>
Plugins Server
</h2>

[![Docker Image CI](https://github.com/TypingMind/plugins-server/actions/workflows/docker-image.yml/badge.svg?branch=main)](https://github.com/TypingMind/plugins-server/actions/workflows/docker-image.yml)
[![CodeQL](https://github.com/TypingMind/plugins-server/actions/workflows/codeql.yml/badge.svg)](https://github.com/TypingMind/plugins-server/actions/workflows/codeql.yml)
[![Build TypingMind Proxy](https://github.com/TypingMind/plugins-server/actions/workflows/test.yml/badge.svg)](https://github.com/TypingMind/plugins-server/actions/workflows/test.yml)

## 🌟 Introduction

Plugins Server provides additional features for [TypingMind's Plugins](https://docs.typingmind.com/plugins) where extra server-side processing is needed.

Plugins Server is used by some built-in plugins on Typing Mind (e.g., Web Page Reader). Other plugins can also make use of the existing endpoints of the Plugins Server if needed. New endpoints can be added via Pull Requests.

Plugins Server is open-sourced and is intended to be self-hosted by individual users for private use only.

**Note**: The Plugins Server only provides an endpoint for retrieving server-side processing results. To make the plugin work, you must also install a TypingMind's plugin configured to send requests to this server endpoint.

## 🔌 How to use (for Typing Mind users)

Two simple steps:

1. Deploy this repo on any hosting provider that supports NodeJS (e.g., Render.com, AWS, etc.). (We also provide a Dockerfile for easy deployment on Docker-supported hosting providers).

2. Install your desired TypingMind's plugin. Update the server endpoint URL in your Settings page.

Follow this guide for detailed instructions: [How to Deploy Plugins Server on Render.com](https://docs.typingmind.com/plugins/plugins-server/how-to-deploy-plugins-server-on-render)

Follow this guide for setting up a TypingMind's plugin: [Build a TypingMind Plugin](https://docs.typingmind.com/plugins/build-a-typingmind-plugin)

## List of available endpoints

After deploying, visit your Plugins Server URL to see the list of available endpoints (served in Swagger UI).

In your local development environment, visit http://localhost:3000 to access the page.

**Note**: this public server only hosts the API documentation. You cannot use this Public Server as your proxy. You must deploy your own Plugins Server to use all the available endpoints.

## 🛠️ Development (for Typing Mind plugins developers)

- **Development Mode:** To start the project in development mode, execute the following command in your terminal:

```bash
npm install
npm run dev
```

## 🤝 Contributing

We welcome your contributions! Help expand TypingMind Plugins Server's capabilities.

- **Plugin Development:** Check out our 'CONTRIBUTING.md' guide for details on creating plugins.
- **Bug Reports & Ideas:** Open issues to report bugs or suggest new features.
- **Documentation:** Help improve our documentation for other developers.


## Deployment note for PM2 environment changes

If you change secrets or environment variables in `SECRET.js`, PM2 may continue running the old process environment until the app is restarted with environment refresh enabled.

Use:

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 22
pm2 restart SECRET.js --only typingmind-proxy --update-env
```


## ⚠️ PM2 + NVM — operational rules

### SAFE: Restart after config changes
Always source NVM first when using `--update-env`. If run from a bare non-interactive SSH session without sourcing NVM, `--update-env` will store a broken PATH (no node) in the process config, causing a crash loop on the next auto-restart.

### UNSAFE: Never do this
```bash
# This captures a PATH with no node binary — causes crash loop:
pm2 restart typingmind-proxy --update-env   # from a non-interactive shell without sourcing NVM
```

### Recovery if crash loop occurs
1. Create system-level node symlinks (already done — this is for reference)
2. Then restart without --update-env

The node symlinks at `/usr/local/bin/` are already in place on this server. They make `/usr/bin/env node` work regardless of whether NVM is loaded in the env, which means PM2 auto-restarts and reboot recovery are safe permanently.

### Why this works
The PM2 systemd startup service already has the NVM node path in its `Environment=` block. The `/usr/local/bin/node` symlink is a second layer of defence. Both together ensure node is always findable.
