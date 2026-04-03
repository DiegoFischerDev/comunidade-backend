import {
  Controller,
  Post,
  Body,
  Get,
  Query,
  UseGuards,
  Patch,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { WhatsappConfirmDto } from './dto/whatsapp-confirm.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /** Chamada interna do receiver Evolution (segredo em `x-internal-secret`). */
  @Public()
  @Post('whatsapp/confirm')
  async whatsappConfirm(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() dto: WhatsappConfirmDto,
  ) {
    const expected = process.env.COMMUNITY_INTERNAL_SECRET;
    if (!expected || secret !== expected) {
      throw new UnauthorizedException();
    }
    return this.authService.confirmWhatsappRegistration(
      dto.code,
      dto.whatsapp,
    );
  }

  /** Polling do browser após registo: devolve JWT quando a conta for criada no WhatsApp. */
  @Public()
  @Get('whatsapp/registration-poll')
  async pollWhatsappRegistration(@Query('token') token?: string) {
    return this.authService.pollWhatsappRegistrationBrowser(token ?? '');
  }

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('verify-email')
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.email, dto.code);
  }

  @Public()
  @Post('resend-verification')
  async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto.email);
  }

  @Public()
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.requestPasswordReset(dto.whatsapp);
  }

  @Public()
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(
      dto.whatsapp,
      dto.code,
      dto.newPassword,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: { id: string; email: string; role: string }) {
    return this.authService.validateUserById(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateMe(
    @CurrentUser() user: { id: string; email: string; role: string },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('impersonate')
  async impersonate(
    @CurrentUser() user: { id: string; email: string; role: string },
    @Body('userId') userId: string,
  ) {
    return this.authService.impersonate(user.id, userId);
  }
}
