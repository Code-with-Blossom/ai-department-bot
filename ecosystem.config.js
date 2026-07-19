module.exports = {
  apps: [
    {
      name: 'whatsapp-bot',
      script: 'index.js',
      cwd: './',

      // --- Restart Policy ---
      // Restart automatically if the bot crashes
      autorestart: true,
      // Wait 3 seconds before restarting after a crash (avoids rapid crash loops)
      restart_delay: 3000,
      // Max number of consecutive restarts in 30 minutes before PM2 gives up
      max_restarts: 10,
      min_uptime: '10s',

      // --- Logging ---
      // Merge stdout and stderr into a single log file
      merge_logs: true,
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // --- Environment ---
      // Load .env variables into the process automatically
      env: {
        NODE_ENV: 'production'
      },

      // --- Watch (disabled) ---
      // Do NOT watch files — we don't want restarts on any file save
      watch: false,

      // --- Windows compatibility ---
      // Required for PM2 on Windows to handle process signals correctly
      kill_timeout: 5000,
      listen_timeout: 8000
    }
  ]
};
