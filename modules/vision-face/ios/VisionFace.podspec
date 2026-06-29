Pod::Spec.new do |s|
  s.name           = 'VisionFace'
  s.version        = '1.0.0'
  s.summary        = 'On-device face detection via Apple Vision'
  s.description    = 'Detect face bounding boxes and capture quality using Apple Vision framework.'
  s.author         = 'MemoTile'
  s.homepage       = 'https://memotile.app'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
