<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null;
  let confettiParticles: ConfettiParticle[] = [];
  let animationFrameId: number;

  class ConfettiParticle {
    x: number;
    y: number;
    size: number;
    color: string;
    rotation: number;
    speedX: number;
    speedY: number;
    opacity: number;
    rotationSpeed: number;

    constructor(x: number, y: number) {
      this.x = x;
      this.y = y;
      this.size = Math.random() * 10 + 5;
      this.color = `hsl(${Math.random() * 360}, 100%, 70%)`;
      this.rotation = Math.random() * 360;
      this.speedX = Math.random() * 6 - 3;
      this.speedY = Math.random() * -10 - 5; // Initial upward burst
      this.opacity = 1;
      this.rotationSpeed = Math.random() * 4 - 2;
    }

    update() {
      this.x += this.speedX;
      this.y += this.speedY;
      this.speedY += 0.2; // Gravity
      this.rotation += this.rotationSpeed;
      this.opacity -= 0.005; // Slower fade out
    }

    draw(ctx: CanvasRenderingContext2D) {
      if (this.opacity <= 0) return;
      ctx.save();
      ctx.translate(this.x + this.size / 2, this.y + this.size / 2);
      ctx.rotate(this.rotation * Math.PI / 180);
      ctx.fillStyle = this.color;
      ctx.globalAlpha = this.opacity;
      ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
      ctx.restore();
    }
  }

  function createConfetti() {
    if(!canvas) return;
    const particleCount = 300;
    const centerX = canvas.width / 2;
    const centerY = canvas.height * 0.8; // Start lower for a fountain effect

    for (let i = 0; i < particleCount; i++) {
      confettiParticles.push(new ConfettiParticle(centerX, centerY));
    }
  }

  function animate() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    confettiParticles.forEach(p => p.update());
    confettiParticles.forEach(p => p.draw(ctx!));
    confettiParticles = confettiParticles.filter(p => p.opacity > 0);

    // Continue animation only if there are particles
    if (confettiParticles.length > 0) {
      animationFrameId = requestAnimationFrame(animate);
    }
  }

  onMount(() => {
    ctx = canvas.getContext('2d');
    if(!canvas || !ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    createConfetti();
    animate();

    const handleResize = () => {
        if(!canvas) return;
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        // Re-create confetti on resize if you want it to adapt, or adjust existing particles
        // For simplicity, let's just clear and let it fade out if resizing during animation
        confettiParticles = []; 
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      confettiParticles = [];
    };
  });

</script>

<canvas bind:this={canvas} class="fixed top-0 left-0 w-full h-full pointer-events-none z-[100]"></canvas> 