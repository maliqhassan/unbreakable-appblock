Pod::Spec.new do |s|
  s.name           = 'UnbreakableLock'
  s.version        = '1.0.0'
  s.summary        = 'OS-level app enforcement for Unbreakable Lock'
  s.description    = 'Wraps FamilyControls, ManagedSettings and DeviceActivity behind a small React Native interface.'
  s.author         = 'Unbreakable Lock'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.license        = { :type => 'MIT' }

  # FamilyControls needs iOS 16; Expo SDK 57 sets the floor at 16.4.
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
