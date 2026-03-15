const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
  mode: 'production',
  entry: './src/main.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'js/[name].[contenthash:8].js',
    chunkFilename: 'js/[name].[contenthash:8].chunk.js',
    clean: true,
    publicPath: './'  // Cambiado de '/' a './' para compatibilidad con Capacitor/Android
  },
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.s[ac]ss$/i,  // Nueva regla para SASS/SCSS
        use: ['style-loader', 'css-loader', 'sass-loader']
      },
      {
        test: /\.(png|svg|jpg|jpeg|gif)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'assets/images/[name].[hash:8][ext]'
        }
      },
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'assets/fonts/[name].[hash:8][ext]'
        }
      }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './index.html',  // Cambiado: ahora apunta a index.html (minúscula) en raíz
      filename: 'index.html',
      inject: 'body',
      minify: {
        removeComments: true,
        collapseWhitespace: true,
        removeRedundantAttributes: true,
        removeScriptTypeAttributes: true,
        removeStyleLinkTypeAttributes: true,
        useShortDoctype: true
      }
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'src/assets',
          to: 'assets',
          noErrorOnMissing: true
        },
        {
          from: 'client/assets',  // Fallback: assets legacy si aún no migraste todo
          to: 'assets',
          noErrorOnMissing: true,
          globOptions: {
            ignore: ['**/.*']  // Ignorar archivos ocultos
          }
        },
        {
          from: 'client/android',  // Si tienes recursos android específicos en client/
          to: 'android',
          noErrorOnMissing: true
        }
      ]
    })
  ],
  resolve: {
    extensions: ['.js', '.json', '.css', '.scss'],  // Agregado .scss
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@core': path.resolve(__dirname, 'src/core'),
      '@vault': path.resolve(__dirname, 'src/vault'),
      '@stream': path.resolve(__dirname, 'src/stream'),
      '@styles': path.resolve(__dirname, 'src/styles')  // Nuevo alias útil
    }
  },
  optimization: {
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all'
        },
        styles: {  // Nuevo: separa CSS en chunks optimizados
          name: 'styles',
          test: /\.css$/,
          chunks: 'all',
          enforce: true
        }
      }
    }
  },
  performance: {
    hints: false,  // Desactiva warnings de archivos grandes en desarrollo
    maxEntrypointSize: 512000,
    maxAssetSize: 512000
  }
};
