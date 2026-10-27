require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# NEXO — plugin iOS (fase 0, 27-10). Mismos métodos que el plugin Android (Kotlin), pero en Swift.
# Lo que iOS permite va real (persistencia de archivos, biometría/Face ID, guardar en galería);
# el Bluetooth y el resto quedan de momento como stubs que resuelven sin romper la app.
Pod::Spec.new do |s|
  s.name = 'NexoBle'
  s.version = package['version']
  s.summary = package['description']
  s.license = 'MIT'
  s.homepage = 'https://nexo.app'
  s.author = 'NEXO'
  s.source = { :git => 'https://nexo.app/nexo-ble.git', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.ios.deployment_target = '13.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
