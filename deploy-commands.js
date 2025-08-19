require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('add')
    .setDescription('Adiciona um streamer')
    .addStringOption(option => option.setName('nome').setDescription('Nome do streamer').setRequired(true)),
  new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Remove um streamer')
    .addStringOption(option => option.setName('nome').setDescription('Nome do streamer').setRequired(true)),
  new SlashCommandBuilder()
    .setName('list')
    .setDescription('Lista os streamers atuais'),
  new SlashCommandBuilder()
    .setName('check')
    .setDescription('Verifica quais streamers estão online agora')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Atualizando comandos slash...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('Comandos atualizados!');
  } catch (error) {
    console.error(error);
  }
})();
