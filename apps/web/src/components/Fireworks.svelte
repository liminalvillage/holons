<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null;
  let fireworks: Firework[] = [];
  let animationFrameId: number;

  class Firework {
    x: number;
    y: number;
    sx: number;
    sy: number;
    size: number;
    color: string;
    dead: boolean = false;
    particles: Particle[] = [];
    exploded: boolean = false;

    constructor(x: number, y: number, sx: number, sy: number, size: number, color: string) {
      this.x = x;
      this.y = y;
      this.sx = sx;
      this.sy = sy;
      this.size = size;
      this.color = color;
    }

    createParticles() {
      const particleCount = Math.floor(Math.random() * 50) + 100; // More particles
      for (let i = 0; i < particleCount; i++) {
        this.particles.push(new Particle(this.x, this.y, this.color));
      }
    }

    update() {
      if (this.dead) return;

      if (!this.exploded) {
        // Update firework rocket
        this.x += this.sx;
        this.y += this.sy;
        this.sy += 0.02; // Gravity

        // Explode when rocket starts falling or reaches a certain height
        if (this.sy >= 0 || this.y <= window.innerHeight * 0.2) {
          this.exploded = true;
          this.createParticles(); // Create particles at explosion point
        }
      } else {
        // Update particles
        this.particles.forEach(p => p.update());
        this.particles = this.particles.filter(p => !p.dead);
        if (this.particles.length === 0) {
          this.dead = true;
        }
      }
    }

    draw(ctx: CanvasRenderingContext2D) {
      if (!this.exploded && !this.dead) { // Draw the rocket before explosion
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
      }
      // Draw particles after explosion
      this.particles.forEach(p => p.draw(ctx));
    }
  }

  class Particle {
    x: number;
    y: number;
    sx: number;
    sy: number;
    size: number;
    color: string;
    dead: boolean = false;
    life: number = 50; // Particle lifespan REDUCED from 100 to 50

    constructor(x: number, y: number, color: string) {
      this.x = x;
      this.y = y;
      this.color = color;
      this.size = Math.random() * 2 + 1;
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 4 + 1; // Increased particle speed
      this.sx = Math.cos(angle) * speed;
      this.sy = Math.sin(angle) * speed - 2; // Give upward thrust initially
    }

    update() {
      if (this.dead) return;
      this.x += this.sx;
      this.y += this.sy;
      this.sy += 0.05; // Gravity on particles
      this.life--;
      if (this.life <= 0) {
        this.dead = true;
      }
    }

    draw(ctx: CanvasRenderingContext2D) {
      if (this.dead) return;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function launchFirework() {
    if (!canvas) return;
    const x = Math.random() * canvas.width;
    const y = canvas.height;
    const sx = Math.random() * 4 - 2; // Horizontal speed
    const sy = -(Math.random() * 4 + 5); // Initial upward speed (stronger)
    const size = Math.random() * 2 + 2;
    const color = `hsl(${Math.random() * 360}, 100%, 70%)`;
    fireworks.push(new Firework(x, y, sx, sy, size, color));
  }

  function animate() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    fireworks.forEach(fw => {
        fw.update();
        fw.draw(ctx!); // Ensure draw is called for updated fireworks
    });
    fireworks = fireworks.filter(fw => !fw.dead); // Remove dead fireworks

    // Continue animation loop - don't stop it until component is destroyed
    animationFrameId = requestAnimationFrame(animate);
  }

  onMount(() => {
    ctx = canvas.getContext('2d');
    if (!canvas || !ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    // Launch an initial burst of 8-12 fireworks
    const burstCount = Math.floor(Math.random() * 5) + 8; // Randomly 8, 9, 10, 11, or 12 fireworks
    for(let i = 0; i < burstCount; i++) {
        // Stagger the launch slightly for a more natural look
        setTimeout(launchFirework, i * 200); 
    }

    animate(); // Start the animation loop

    const handleResize = () => {
        if(!canvas) return;
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  });

</script>

<canvas bind:this={canvas} class="fixed top-0 left-0 w-full h-full pointer-events-none z-[100]"></canvas> 