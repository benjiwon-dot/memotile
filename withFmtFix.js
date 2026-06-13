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
        const fix = `post_install do |installer|
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      flags = config.build_settings['OTHER_CPLUSPLUSFLAGS'] || ['$(inherited)']
      flags = [flags] if flags.is_a?(String)
      flags << '-Wno-error=consteval-expression-not-constant'
      flags << '-Wno-consteval-expression-not-constant'
      config.build_settings['OTHER_CPLUSPLUSFLAGS'] = flags
      
      defs = config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] || ['$(inherited)']
      defs = [defs] if defs.is_a?(String)
      defs << 'FMT_CONSTEVAL=constexpr'
      config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = defs
    end
  end`;
        if (!contents.includes("FMT_CONSTEVAL=constexpr")) {
          contents = contents.replace(/post_install do \|installer\|/g, fix);
          fs.writeFileSync(podfile, contents);
        }
      }
      return config;
    }
  ]);
};
