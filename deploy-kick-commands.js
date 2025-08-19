require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('kickadd')
    .setDescription('Adiciona um streamer da Kick à lista')
    .addStringOption(option =>
      option.setName('nome')
        .setDescription('Nome do streamer na Kick')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('kickremove')
    .setDescription('Remove um streamer da Kick da lista')
    .addStringOption(option =>
      option.setName('nome')
        .setDescription('Nome do streamer na Kick')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('kicklist')
    .setDescription('Lista todos os streamers da Kick cadastrados'),

  new SlashCommandBuilder()
    .setName('kickcheck')
    .setDescription('Verifica se um streamer da Kick está ao vivo')
    .addStringOption(option =>
      option.setName('nome')
        .setDescription('Nome do streamer na Kick')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('live')
    .setDescription('Mostra todos os streamers da Kick que estão online agora')
].map(command => command.toJSON());

async function deploy() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    console.log('🚀 Atualizando comandos Slash...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Comandos atualizados com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao atualizar comandos:', error);
  }
}

module.exports = { deploy };
