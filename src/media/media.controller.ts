import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsString, MaxLength } from 'class-validator';
import { AdminGuard } from '../common/admin.guard';
import { MediaService } from './media.service';

class UpdateMediaDto {
  @IsString() @MaxLength(300) alt: string;
}

@UseGuards(AdminGuard)
@Controller('admin/media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get()
  list(@Query('search') search?: string) {
    return this.media.list(search);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  upload(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMediaDto) {
    return this.media.updateAlt(id, dto.alt);
  }

  @HttpCode(204)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.media.remove(id);
  }
}
