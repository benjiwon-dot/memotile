const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withFmtFix(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfile = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      if (fs.existsSync(podfile)) {
        let contents = fs.readFileSync(podfile, 'utf-8');
        
        // 다운로드 완료된 fmt 헤더 파일을 직접 열어서 물리적으로 글자를 바꿔버리는 Ruby 코드
        const rubyPatch = `
  # --- fmt consteval fix ---
  fmt_path = File.join(__dir__, 'Pods/fmt/include/fmt/format-inl.h')
  if File.exist?(fmt_path)
    text = File.read(fmt_path)
    text = text.gsub('FMT_CONSTEVAL consteval', 'FMT_CONSTEVAL constexpr')
    File.write(fmt_path, text)
  end
  # -------------------------`;
        
        if (!contents.includes('fmt consteval fix')) {
          contents = contents.replace(
            /post_install do \|installer\|/g,
            `post_install do |installer|\n${rubyPatch}`
          );
          fs.writeFileSync(podfile, contents);
        }
      }
      return config;
    },
  ]);
};
