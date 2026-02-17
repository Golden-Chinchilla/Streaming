'use client';

import Link from 'next/link';
import { EmptyStateIllustration } from '@/components/illustrations/EmptyStateIllustration';
import { ArrowLeft } from 'lucide-react';

export default function NotFound() {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-base">
            <div className="w-full max-w-md mx-auto text-center space-y-8">

                {/* Illustration */}
                <div className="w-full aspect-square max-w-100 mx-auto">
                    <EmptyStateIllustration
                        animate={true}
                        className="w-full h-full drop-shadow-xl illustration-glow"
                    />
                </div>

                {/* Content */}
                <div className="space-y-4 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
                    <h1 className="text-4xl font-bold font-display tracking-tight text-text-primary">
                        Page Not Found
                    </h1>
                    <p className="text-text-secondary text-lg">
                        We couldn&apos;t find the page you were looking for. It might have been moved or deleted.
                    </p>
                </div>

                {/* Action */}
                <div className="pt-4 animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
                    <Link
                        href="/"
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-primary text-on-primary font-medium hover:opacity-90 transition-opacity"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back to Dashboard
                    </Link>
                </div>

            </div>
        </div>
    );
}
