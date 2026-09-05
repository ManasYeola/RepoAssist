require('dotenv').config();
const app = require('./app');

const { startKeepAlive } = require('./utils/keepAlive');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 RepoAssist Backend running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  startKeepAlive();
});

