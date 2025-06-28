// ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'typingmind-proxy-test',
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'development',
        PORT: '3000',
      },
    },
  ],
};
