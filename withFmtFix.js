const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

module.exports = function withFmtFix(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      if (!fs.existsSync(podfilePath)) return config;

      let content = fs.readFileSync(podfilePath, 'utf-8');
      if (content.includes('Fix fmt 11.0.2 consteval')) return config;

      // Expo 커뮤니티 공식 패치: fmt/base.h의 하드코딩된 consteval 활성화를 강제로 0으로 변경
      const patchCode = `
    # Fix fmt 11.0.2 consteval compilation error with Xcode 26.4+
    fmt_base = File.join(installer.sandbox.pod_dir('fmt'), 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base)
      File.chmod(0644, fmt_base)
      base_content = File.read(fmt_base)
      patched = base_content.gsub(/#\\s*define FMT_USE_CONSTEVAL 1/, '# define FMT_USE_CONSTEVAL 0')
      if patched != base_content
        File.write(fmt_base, patched)
        puts "✅ Patched fmt/base.h: disabled FMT_USE_CONSTEVAL"
      end
    end`;

      content = content.replace(
        /post_install do \|installer\|/g,
        `post_install do |installer|\n${patchCode}`
      );
      
      fs.writeFileSync(podfilePath, content);
      return config;
    },
  ]);
};
