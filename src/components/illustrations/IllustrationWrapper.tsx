import React from 'react';
import { cn } from '@/lib/utils';

interface IllustrationWrapperProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
    className?: string;
    animate?: boolean;
}

export const IllustrationWrapper: React.FC<IllustrationWrapperProps> = ({
    children,
    className,
    animate = true,
    ...props
}) => {
    return (
        <div
            className={cn(
                "relative flex items-center justify-center w-full h-full min-h-75",
                animate ? "animate-in fade-in duration-700 slide-in-from-bottom-4" : "",
                className
            )}
            {...props}
        >
            <div className="relative w-full h-full max-w-full max-h-full flex items-center justify-center [&>svg]:w-full [&>svg]:h-full [&>svg]:max-h-150">
                {children}
            </div>
        </div>
    );
};
