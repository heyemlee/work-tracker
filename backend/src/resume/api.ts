import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  Delete,
  Header,
  Post,
  ServiceUnavailableException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { LocalGuard } from '../auth.js';
import { validate } from '../validation.js';
import { extractResume, MAX_FILE_BYTES } from './extract.js';
import { parseInputSchema, parseResume } from './model.js';
import { createSettings, modelListInput, removeKeyInput, settingsInput } from './settings.js';
import { EVAL_LEDGER, modelPolicy, quoteRequest, withBudget } from './budget.js';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

@Controller('/api/resumes')
@UseGuards(LocalGuard)
export class ResumeApi {
  private busy = false;
  private readonly settings = createSettings();
  @Get('/status')
  @Header('Cache-Control', 'no-store')
  status() {
    return this.settings.status();
  }
  @Post('/models')
  @Header('Cache-Control', 'no-store')
  async listModels(@Body() body: unknown) {
    const input = validate(modelListInput, body);
    try {
      return await this.settings.listModels(input);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '获取模型列表失败。');
    }
  }
  @Put('/settings')
  @Header('Cache-Control', 'no-store')
  async saveSettings(@Body() body: unknown) {
    if (this.busy) throw new ServiceUnavailableException('正在解析，请完成后再修改配置。');
    const input = validate(settingsInput, body);
    try {
      return await this.settings.save(input);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '配置保存失败。');
    }
  }
  @Delete('/settings')
  @Header('Cache-Control', 'no-store')
  async removeKey(@Body() body: unknown) {
    if (this.busy) throw new ServiceUnavailableException('正在解析，请完成后再修改配置。');
    const input = validate(removeKeyInput, body);
    try {
      return await this.settings.remove(input.provider);
    } catch {
      throw new BadRequestException('移除密钥失败，请稍后重试。');
    }
  }
  @Post('/check-connection')
  @Header('Cache-Control', 'no-store')
  async checkConnection() {
    try {
      return await this.settings.check();
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '连接检查失败。');
    }
  }
  @Post('/extract')
  @Header('Cache-Control', 'no-store')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0 } }))
  async extract(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('请先选择简历文件。');
    try {
      return await extractResume(file.buffer, file.originalname);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '文件读取失败。');
    }
  }
  @Post('/parse')
  @Header('Cache-Control', 'no-store')
  async parse(@Body() body: unknown) {
    const input = validate(parseInputSchema, body);
    const config = this.settings.config();
    if (!config) throw new ServiceUnavailableException('AI 解析尚未启用。仍可在本地读取文件文字。');
    const policy = modelPolicy(config.provider ?? 'anthropic', config.model);
    if (!policy.canParse) throw new BadRequestException(policy.reason);
    if (this.busy) throw new ServiceUnavailableException('已有简历正在解析，请稍后再试。');
    this.busy = true;
    try {
      const quote = quoteRequest(input.text, input.method, config.model, config.provider);
      await mkdir(dirname(EVAL_LEDGER), { recursive: true, mode: 0o700 });
      return await withBudget(EVAL_LEDGER, 5, async (budget) => {
        const reservationId = await budget.reserve(`web-${randomUUID()}`, quote);
        const result = await parseResume(input.text, input.method, config);
        await budget.recordUsage(reservationId, result.usage);
        return { ...result, budget: budget.summary() };
      });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '模型解析失败。');
    } finally {
      this.busy = false;
    }
  }
}
