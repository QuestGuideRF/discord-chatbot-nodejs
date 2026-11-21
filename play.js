const { EmbedBuilder } = require('discord.js');
const ytdl = require('ytdl-core');
const ytSearch = require('yt-search');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const queue = new Map();
module.exports = {
  name: 'play',
  aliases: ['p'],
  category: 'music',
  description: 'Воспроизводит музыку из YouTube',
  usage: 'play <название песни или URL>',
  cooldown: 3,
  async execute(message, args, client) {
    if (!args.length) {
      return message.reply('Пожалуйста, укажите название песни или URL для воспроизведения.');
    }
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      return message.reply('Вы должны находиться в голосовом канале для использования этой команды.');
    }
    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has('CONNECT') || !permissions.has('SPEAK')) {
      return message.reply('У меня нет прав для подключения или воспроизведения музыки в этом канале.');
    }
    const serverQueue = queue.get(message.guild.id);
    const songQuery = args.join(' ');
    let song = {};
    if (ytdl.validateURL(songQuery)) {
      const songInfo = await ytdl.getInfo(songQuery);
      song = {
        title: songInfo.videoDetails.title,
        url: songInfo.videoDetails.video_url,
        duration: formatDuration(songInfo.videoDetails.lengthSeconds),
        thumbnail: songInfo.videoDetails.thumbnails[0].url,
        requestedBy: message.author.tag,
      };
    } else {
      try {
        const videoFinder = async (query) => {
          const videoResult = await ytSearch(query);
          return videoResult.videos.length > 0 ? videoResult.videos[0] : null;
        };
        const video = await videoFinder(songQuery);
        if (video) {
          song = {
            title: video.title,
            url: video.url,
            duration: video.duration.timestamp,
            thumbnail: video.thumbnail,
            requestedBy: message.author.tag,
          };
        } else {
          return message.reply('Не удалось найти видео по вашему запросу.');
        }
      } catch (error) {
        console.error(error);
        return message.reply('Произошла ошибка при поиске видео.');
      }
    }
    if (!serverQueue) {
      const queueConstructor = {
        voiceChannel: voiceChannel,
        textChannel: message.channel,
        connection: null,
        player: null,
        songs: [],
        volume: 5,
        playing: true,
      };
      queue.set(message.guild.id, queueConstructor);
      queueConstructor.songs.push(song);
      try {
        const connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: message.guild.id,
          adapterCreator: message.guild.voiceAdapterCreator,
        });
        queueConstructor.connection = connection;
        const player = createAudioPlayer();
        queueConstructor.player = player;
        connection.subscribe(player);
        playSong(message.guild.id, queueConstructor.songs[0]);
      } catch (error) {
        console.error(error);
        queue.delete(message.guild.id);
        return message.reply('Произошла ошибка при подключении к голосовому каналу.');
      }
    } else {
      serverQueue.songs.push(song);
      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('Добавлено в очередь')
        .setDescription(`**[${song.title}](${song.url})**`)
        .setThumbnail(song.thumbnail)
        .addFields(
          { name: 'Продолжительность', value: song.duration, inline: true },
          { name: 'Запросил', value: song.requestedBy, inline: true },
          { name: 'Позиция в очереди', value: `${serverQueue.songs.length - 1}`, inline: true }
        )
        .setTimestamp();
      return message.channel.send({ embeds: [embed] });
    }
  },
};
async function playSong(guild, song) {
  const serverQueue = queue.get(guild);
  if (!song) {
    serverQueue.connection.destroy();
    queue.delete(guild);
    return;
  }
  try {
    const stream = ytdl(song.url, {
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1 << 25
    });
    const resource = createAudioResource(stream);
    serverQueue.player.play(resource);
    serverQueue.player.on(AudioPlayerStatus.Idle, () => {
      serverQueue.songs.shift();
      playSong(guild, serverQueue.songs[0]);
    });
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('Сейчас играет')
      .setDescription(`**[${song.title}](${song.url})**`)
      .setThumbnail(song.thumbnail)
      .addFields(
        { name: 'Продолжительность', value: song.duration, inline: true },
        { name: 'Запросил', value: song.requestedBy, inline: true }
      )
      .setTimestamp();
    serverQueue.textChannel.send({ embeds: [embed] });
  } catch (error) {
    console.error(error);
    serverQueue.textChannel.send('Произошла ошибка при воспроизведении песни.');
    serverQueue.songs.shift();
    playSong(guild, serverQueue.songs[0]);
  }
}
function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  } else {
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
}