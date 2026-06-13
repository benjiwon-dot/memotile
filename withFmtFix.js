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
        
        // 띄어쓰기 돌발 변수까지 완벽 대응하는 최종 정제된 sed 수술 명령어
        const sedCommand = `  system("find Pods/fmt -type f -name '*.h' -exec sed -i '' -E 's/FMT_CONSTEVAL[[:space:]]+consteval/FMT_CONSTEVAL constexpr/g' {} +")`;
        
        if (!contents.includes('find Pods/fmt')) {
          contents = contents.replace(
            /post_install do \|installer\|/g,
            `post_install do |installer|\n${sedCommand}`
          );
          fs.writeFileSync(podfile, contents);
        }
      }
      return config;
    },
  ]);
};
