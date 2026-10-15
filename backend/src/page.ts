import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LocalGuard } from './auth.js';

const path = (name: string) => fileURLToPath(new URL(`../../web/${name}`, import.meta.url));
@Controller()
@UseGuards(LocalGuard)
export class Page {
  @Get('/')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  )
  @Header('Cache-Control', 'no-store')
  index() {
    return readFile(path('index.html'), 'utf8');
  }
  @Get('/app.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  script() {
    return readFile(path('app.js'), 'utf8');
  }
  @Get('/style.css')
  @Header('Content-Type', 'text/css; charset=utf-8')
  style() {
    return readFile(path('style.css'), 'utf8');
  }
  @Get('/design.css')
  @Header('Content-Type', 'text/css; charset=utf-8')
  design() {
    return readFile(path('.generated/design.css'), 'utf8');
  }
  @Get('/outbox.svg')
  @Header('Content-Type', 'image/svg+xml')
  brand() {
    return readFile(path('.generated/outbox.svg'), 'utf8');
  }
  @Get('/theme.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  theme() {
    return readFile(path('theme.js'), 'utf8');
  }
  @Get('/glass.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  glass() {
    return readFile(path('glass.js'), 'utf8');
  }
  @Get('/refraction.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  refraction() {
    return readFile(path('.generated/refraction.js'), 'utf8');
  }
}
