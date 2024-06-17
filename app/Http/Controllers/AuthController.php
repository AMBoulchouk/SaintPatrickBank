<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use App\Models\User;

class AuthController extends Controller
{
    public function showLoginForm()
    {
        return view('auth.login');
    }

    public function login(Request $request)
    {
        $request->validate([
            'card_number' => 'required',
            'pin' => 'required',
        ]);

        $user = User::where('card_number', $request->card_number)->first();

        if ($user && Hash::check($request->pin, $user->pin)) {
            Auth::login($user);
            $request->session()->regenerate();
            return redirect()->intended('home');
        }

        return back()->withErrors([
            'card_number' => 'Las credenciales no son válidas',
        ]);
    }

    public function logout(Request $request)
    {
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();
        return redirect('/login');
    }
}
