import typescript from '@rollup/plugin-typescript'

const external = ['@leafer-ui/core', '@leafer-ui/interface']

export default {
  input: 'src/index.ts',
  external,
  plugins: [typescript({ tsconfig: './tsconfig.json' })],
  output: [
    {
      file: 'dist/viewport-boost.esm.js',
      format: 'esm'
    },
    {
      file: 'dist/viewport-boost.cjs',
      format: 'cjs',
      exports: 'named'
    },
    {
      file: 'dist/viewport-boost.umd.js',
      format: 'umd',
      name: 'LeaferX.viewportBoost',
      globals: {
        '@leafer-ui/core': 'LeaferUI',
        '@leafer-ui/interface': 'LeaferUI'
      }
    }
  ]
}
