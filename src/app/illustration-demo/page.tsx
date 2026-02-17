'use client';

import React, { useState } from 'react';
import { HeroIllustration } from '@/components/illustrations/HeroIllustration';
import { AnalyzeIllustration } from '@/components/illustrations/AnalyzeIllustration';
import { EmptyStateIllustration } from '@/components/illustrations/EmptyStateIllustration';

export default function IllustrationDemoPage() {
    const [primaryColor, setPrimaryColor] = useState('#FF9F1A'); // Default from Hero
    const [accentColor, setAccentColor] = useState('#6366F1'); // Indigo
    const [secondaryColor, setSecondaryColor] = useState('#10B981'); // Emerald
    const [tertiaryColor, setTertiaryColor] = useState('#EC4899'); // Pink
    const [animate, setAnimate] = useState(true);
    const [darkMode, setDarkMode] = useState(false);

    return (
        <div className={`min-h-screen p-8 transition-colors duration-300 ${darkMode ? 'bg-slate-900 text-white' : 'bg-gray-50 text-slate-900'}`}>
            <div className="max-w-6xl mx-auto">
                <header className="mb-12">
                    <h1 className="text-4xl font-bold mb-4">Illustration System</h1>
                    <p className="opacity-70 max-w-2xl">
                        A demonstrator for the dynamic SVG component factory.
                        Adjust the controls below to see real-time theming and animation toggles across all illustrations.
                    </p>
                </header>

                {/* Controls */}
                <div className={`p-6 rounded-xl shadow-sm mb-12 border ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'}`}>
                    <h2 className="text-xl font-semibold mb-6">Theme Controls</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-6">

                        {/* Color Pickers */}
                        <div className="space-y-2">
                            <label className="text-xs font-medium uppercase tracking-wider opacity-70">Primary Color</label>
                            <div className="flex items-center gap-3">
                                <input
                                    type="color"
                                    value={primaryColor}
                                    onChange={(e) => setPrimaryColor(e.target.value)}
                                    className="h-10 w-10 rounded cursor-pointer border-0 p-0"
                                />
                                <span className="font-mono text-sm">{primaryColor}</span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-medium uppercase tracking-wider opacity-70">Accent Color</label>
                            <div className="flex items-center gap-3">
                                <input
                                    type="color"
                                    value={accentColor}
                                    onChange={(e) => setAccentColor(e.target.value)}
                                    className="h-10 w-10 rounded cursor-pointer border-0 p-0"
                                />
                                <span className="font-mono text-sm">{accentColor}</span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-medium uppercase tracking-wider opacity-70">Secondary Color</label>
                            <div className="flex items-center gap-3">
                                <input
                                    type="color"
                                    value={secondaryColor}
                                    onChange={(e) => setSecondaryColor(e.target.value)}
                                    className="h-10 w-10 rounded cursor-pointer border-0 p-0"
                                />
                                <span className="font-mono text-sm">{secondaryColor}</span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-medium uppercase tracking-wider opacity-70">Tertiary Color</label>
                            <div className="flex items-center gap-3">
                                <input
                                    type="color"
                                    value={tertiaryColor}
                                    onChange={(e) => setTertiaryColor(e.target.value)}
                                    className="h-10 w-10 rounded cursor-pointer border-0 p-0"
                                />
                                <span className="font-mono text-sm">{tertiaryColor}</span>
                            </div>
                        </div>

                        {/* Toggles */}
                        <div className="space-y-4 lg:col-span-2 flex flex-col justify-end">
                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={animate}
                                    onChange={(e) => setAnimate(e.target.checked)}
                                    className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="font-medium">Enable Animations</span>
                            </label>

                            <label className="flex items-center gap-3 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={darkMode}
                                    onChange={(e) => setDarkMode(e.target.checked)}
                                    className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="font-medium">Dark Mode Preview</span>
                            </label>
                        </div>

                    </div>
                </div>

                {/* Gallery */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                    {/* Card 1 */}
                    <div className={`rounded-2xl overflow-hidden border transition-all hover:shadow-lg ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-100 shadow-sm'}`}>
                        <div className="p-4 border-b border-gray-100/10 flex justify-between items-center text-sm font-medium opacity-60">
                            Hero Illustration
                            <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">Homepage</span>
                        </div>
                        <div className="p-8 flex items-center justify-center min-h-100 w-full">
                            <div className="w-full max-w-100">
                                <HeroIllustration
                                    primaryColor={primaryColor}
                                    accentColor={accentColor}
                                    secondaryColor={secondaryColor}
                                    tertiaryColor={tertiaryColor}
                                    animate={animate}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Card 2 */}
                    <div className={`rounded-2xl overflow-hidden border transition-all hover:shadow-lg ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-100 shadow-sm'}`}>
                        <div className="p-4 border-b border-gray-100/10 flex justify-between items-center text-sm font-medium opacity-60">
                            Analyze Illustration
                            <span className="text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300">Dashboard</span>
                        </div>
                        <div className="p-8 flex items-center justify-center min-h-100 w-full">
                            <div className="w-full max-w-100">
                                <AnalyzeIllustration
                                    primaryColor={primaryColor}
                                    accentColor={accentColor}
                                    secondaryColor={secondaryColor}
                                    tertiaryColor={tertiaryColor}
                                    animate={animate}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Card 3 */}
                    <div className={`rounded-2xl overflow-hidden border transition-all hover:shadow-lg ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-100 shadow-sm'}`}>
                        <div className="p-4 border-b border-gray-100/10 flex justify-between items-center text-sm font-medium opacity-60">
                            Empty State
                            <span className="text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300">404 / No Data</span>
                        </div>
                        <div className="p-8 flex items-center justify-center min-h-100 w-full">
                            <div className="w-full max-w-100">
                                <EmptyStateIllustration
                                    primaryColor={primaryColor}
                                    accentColor={accentColor}
                                    secondaryColor={secondaryColor}
                                    tertiaryColor={tertiaryColor}
                                    animate={animate}
                                />
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}
