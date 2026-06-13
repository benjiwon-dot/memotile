const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withFmtFix(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfile = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      if (fs.existsSync(podfile)) {
        let contents = fs.readFileSync(podfile, 'utf-8');
        const fixCode = `
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= ['$(inherited)']
      config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] << 'FMT_HAS_CONSTEVAL=0'
    end
  end
`;
        if (!contents.includes('FMT_HAS_CONSTEVAL=0')) {
          contents = contents.replace(
            /post_install do \|installer\|/g,
            `post_install do |installer|\n${fixCode}`
          );
          fs.writeFileSync(podfile, contents);
        }
      }
      return config;
    },
  ]);
};
