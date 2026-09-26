module.exports = {
  apps: [
    {
      name: 'insuredmine-assessment',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      restart_delay: 3000,
      watch: false,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
