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
        
        // 특정 문장 매칭이 아닌, fmt 폴더 내의 모든 파일에서 'consteval' 단어 자체를 멸종시키는 무적의 코드
        const rubyPatch = `
  # === FMT CONSTEVAL NUCLEAR FIX ===
  fmt_dir = File.join(installer.sandbox.root, 'fmt', 'include', 'fmt')
  if Dir.exist?(fmt_dir)
    Dir.glob("#{fmt_dir}/**/*.{h,cc}").each do |file|
      content = File.read(file)
      if content.include?('consteval')
        File.chmod(0644, file)
        File.write(file, content.gsub('consteval', 'constexpr'))
        puts "✅ Wiped consteval from #{File.basename(file)}"
      end
    end
  end
  # =================================`;

        if (!contents.includes('FMT CONSTEVAL NUCLEAR FIX')) {
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
