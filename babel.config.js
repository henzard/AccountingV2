module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./src'],
          alias: {
            '@domain': './src/domain',
            '@data': './src/data',
            '@presentation': './src/presentation',
            '@infrastructure': './src/infrastructure',
          },
        },
      ],
    ],
  };
};
