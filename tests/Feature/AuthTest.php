<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use RefreshDatabase;

    public function test_login_with_valid_credentials()
    {
        $user = User::factory()->create([
            'card_number' => '4546-8574-1856-5565',
            'pin' => bcrypt('4345'),
        ]);

        $response = $this->post('/login', [
            'card_number' => '4546-8574-1856-5565',
            'pin' => '4345',
        ]);

        $response->assertRedirect('/home');
        $this->assertAuthenticatedAs($user);
    }

    public function test_login_with_invalid_credentials()
    {
        $user = User::factory()->create([
            'card_number' => '4546-8574-1856-5565',
            'pin' => bcrypt('4345'),
        ]);

        $response = $this->post('/login', [
            'card_number' => '4546-8574-1856-5565',
            'pin' => '1234',
        ]);

        $response->assertSessionHasErrors();
        $this->assertGuest();
    }
}
