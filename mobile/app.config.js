const { themes } = require("./src/theme/tokens");
module.exports = ({ config }) => ({ ...config, android: { ...config.android, adaptiveIcon: { ...config.android.adaptiveIcon, backgroundColor: themes.dark.bg } } });
