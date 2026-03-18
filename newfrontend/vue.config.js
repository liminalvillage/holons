const webpack = require('webpack')

module.exports = {
  transpileDependencies: ['holosphere'],
  configureWebpack: {
    externals: {
      'openai': 'null'
    },
    plugins: [
      new webpack.DefinePlugin({
        'process.env': '{}'
      })
    ]
  }
}
